type Constraint =
  | { type: "eq"; field: string; value: unknown }
  | { type: "gte"; field: string; value: unknown }
  | { type: "gt"; field: string; value: unknown }
  | { type: "lt"; field: string; value: unknown }
  | { type: "lte"; field: string; value: unknown };

type AnyDoc = {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
};

class QueryBuilder {
  public readonly constraints: Constraint[] = [];

  eq(field: string, value: unknown) {
    this.constraints.push({ type: "eq", field, value });
    return this;
  }

  gte(field: string, value: unknown) {
    this.constraints.push({ type: "gte", field, value });
    return this;
  }

  gt(field: string, value: unknown) {
    this.constraints.push({ type: "gt", field, value });
    return this;
  }

  lt(field: string, value: unknown) {
    this.constraints.push({ type: "lt", field, value });
    return this;
  }

  lte(field: string, value: unknown) {
    this.constraints.push({ type: "lte", field, value });
    return this;
  }
}

// Full-text search: documents whose field holds any of the query's terms.
class SearchBuilder {
  public readonly constraints: Constraint[] = [];
  public filter?: { field: string; terms: string[] };

  search(field: string, query: string) {
    this.filter = { field, terms: query.toLowerCase().split(/\s+/).filter(Boolean) };
    return this;
  }

  eq(field: string, value: unknown) {
    this.constraints.push({ type: "eq", field, value });
    return this;
  }
}

class InMemoryQuery {
  private readonly beat: "asc" | "desc";

  constructor(
    private readonly db: InMemoryDB,
    private readonly table: string,
    private readonly constraints: Constraint[],
    beat: "asc" | "desc" = "asc",
    private readonly indexName?: string,
    private readonly searchFilter?: { field: string; terms: string[] },
  ) {
    this.beat = beat;
  }

  withIndex(indexName: string, build: (builder: QueryBuilder) => QueryBuilder) {
    const builder = new QueryBuilder();
    build(builder);
    return new InMemoryQuery(this.db, this.table, builder.constraints, this.beat, indexName);
  }

  withSearchIndex(_indexName: string, build: (builder: SearchBuilder) => SearchBuilder) {
    const builder = new SearchBuilder();
    build(builder);
    return new InMemoryQuery(this.db, this.table, builder.constraints, this.beat, undefined, builder.filter);
  }

  order(beat: "asc" | "desc") {
    return new InMemoryQuery(this.db, this.table, this.constraints, beat, this.indexName, this.searchFilter);
  }

  async collect() {
    return this.execute();
  }

  async *[Symbol.asyncIterator]() {
    // Convex helpers consume the underlying indexed iterator, including the
    // creation-time and ID tie breakers of real Convex indexes.
    yield* this.execute(true);
  }

  async take(limit: number) {
    return this.execute().slice(0, limit);
  }

  async paginate({ cursor, numItems }: { cursor: string | null; numItems: number }) {
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid mock cursor");
    const docs = this.execute();
    const page = docs.slice(offset, offset + numItems);
    return { page, isDone: offset + page.length >= docs.length, continueCursor: String(offset + page.length) };
  }

  async unique() {
    const docs = this.execute();
    if (docs.length === 0) {
      return null;
    }
    if (docs.length > 1) {
      throw new Error(`Expected unique result in table ${this.table} but found ${docs.length}`);
    }
    return docs[0];
  }

  async first() {
    const docs = this.execute();
    return docs.length > 0 ? docs[0] : null;
  }

  private execute(indexTieBreakers = false) {
    const docs = this.db.getTableDocs(this.table).filter((doc) => {
      if (this.searchFilter) {
        const text = String(doc[this.searchFilter.field] ?? "").toLowerCase();
        if (!this.searchFilter.terms.some((term) => text.includes(term))) return false;
      }
      for (const constraint of this.constraints) {
        const value = doc[constraint.field];
        if (constraint.type === "eq") {
          if (value !== constraint.value) {
            return false;
          }
          continue;
        }

        if (constraint.type === "lt" || constraint.type === "lte") {
          if (value === undefined || value === null) {
            return false;
          }
          const bound = constraint.value as string | number;
          const current = value as string | number;
          if (constraint.type === "lt" ? current >= bound : current > bound) {
            return false;
          }
          continue;
        }

        if (value === undefined || value === null) {
          return false;
        }
        if (constraint.type === "gt"
          ? (value as string | number) <= (constraint.value as string | number)
          : (value as string | number) < (constraint.value as string | number)) {
          return false;
        }
      }
      return true;
    });

    // A test can declare an index's field order (see createMockConvexMutationCtx);
    // otherwise documents fall back to the generic name/creation order.
    const indexFields = this.indexName ? this.db.indexOrder[`${this.table}.${this.indexName}`] : undefined;
    const sorted = [...docs].sort((left, right) => {
      if (indexFields) {
        for (const field of indexFields) {
          const a = left[field] as string | number | undefined;
          const b = right[field] as string | number | undefined;
          if (a === b) continue;
          if (a === undefined) return -1;
          if (b === undefined) return 1;
          return a < b ? -1 : 1;
        }
        return left._creationTime - right._creationTime || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
      }
      const hasNormalized = left.normalizedName !== undefined || right.normalizedName !== undefined;
      if (hasNormalized) {
        const a = String(left.normalizedName ?? "");
        const b = String(right.normalizedName ?? "");
        return a.localeCompare(b);
      }

      const a = Number(left.createdAt ?? left._creationTime);
      const b = Number(right.createdAt ?? right._creationTime);
      if (a !== b || !indexTieBreakers) return a - b;
      const time = left._creationTime - right._creationTime;
      return time || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
    });

    if (this.beat === "desc") {
      sorted.reverse();
    }

    return sorted;
  }
}

class InMemoryDB {
  private readonly tables = new Map<string, Map<string, AnyDoc>>();
  private readonly counters = new Map<string, number>();

  constructor(public readonly indexOrder: Record<string, string[]> = {}) {}

  private ensureTable(table: string) {
    let docs = this.tables.get(table);
    if (!docs) {
      docs = new Map<string, AnyDoc>();
      this.tables.set(table, docs);
    }
    return docs;
  }

  getTableDocs(table: string) {
    return Array.from(this.ensureTable(table).values());
  }

  async get<T = AnyDoc>(id: string): Promise<T | null> {
    const table = id.split(":")[0] ?? "";
    if (!table) return null;
    const doc = this.ensureTable(table).get(id) ?? null;
    return doc as T | null;
  }

  async insert(table: string, value: Record<string, unknown>) {
    const next = (this.counters.get(table) ?? 0) + 1;
    this.counters.set(table, next);
    const id = `${table}:${next}`;
    const doc: AnyDoc = {
      _id: id,
      _creationTime: Date.now(),
      ...value,
    };
    this.ensureTable(table).set(id, doc);
    return id;
  }

  async patch(id: string, patch: Record<string, unknown>) {
    const table = id.split(":")[0] ?? "";
    const docs = this.ensureTable(table);
    const existing = docs.get(id);
    if (!existing) {
      throw new Error(`Document not found: ${id}`);
    }

    docs.set(id, {
      ...existing,
      ...patch,
    });
  }

  async delete(id: string) {
    const table = id.split(":")[0] ?? "";
    this.ensureTable(table).delete(id);
  }

  query(table: string) {
    return new InMemoryQuery(this, table, []);
  }

  // Mock IDs are "<table>:<n>"; a string from another table is not an ID here.
  normalizeId(table: string, id: string) {
    return id.startsWith(`${table}:`) ? id : null;
  }
}

export type MockConvexOptions = {
  /**
   * Field order of named indexes, keyed "table.index" (e.g.
   * "moodboardItems.by_moodboard_position": ["moodboardId", "position"]), so
   * reads through them come back in the order real Convex returns.
   */
  indexOrder?: Record<string, string[]>;
};

export const createMockConvexMutationCtx = (options: MockConvexOptions = {}) => {
  const db = new InMemoryDB(options.indexOrder);
  const ctx = {
    db,
    scheduler: {
      runAfter: async () => null,
    },
    storage: {
      store: async (blob: Blob) =>
        await db.insert("_storage", {
          size: blob.size,
          type: blob.type,
        }),
      delete: async (storageId: string) => {
        await db.delete(storageId);
      },
      getUrl: async (storageId: string) => `https://convex.test/storage/${storageId}`,
    },
  };

  return { ctx, db };
};
