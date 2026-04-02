type Constraint =
  | { type: "eq"; field: string; value: unknown }
  | { type: "gte"; field: string; value: unknown };

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
}

class InMemoryQuery {
  private readonly direction: "asc" | "desc";

  constructor(
    private readonly db: InMemoryDB,
    private readonly table: string,
    private readonly constraints: Constraint[],
    direction: "asc" | "desc" = "asc",
  ) {
    this.direction = direction;
  }

  withIndex(_indexName: string, build: (builder: QueryBuilder) => QueryBuilder) {
    const builder = new QueryBuilder();
    build(builder);
    return new InMemoryQuery(this.db, this.table, builder.constraints, this.direction);
  }

  order(direction: "asc" | "desc") {
    return new InMemoryQuery(this.db, this.table, this.constraints, direction);
  }

  async collect() {
    return this.execute();
  }

  async take(limit: number) {
    return this.execute().slice(0, limit);
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

  private execute() {
    const docs = this.db.getTableDocs(this.table).filter((doc) => {
      for (const constraint of this.constraints) {
        const value = doc[constraint.field];
        if (constraint.type === "eq") {
          if (value !== constraint.value) {
            return false;
          }
          continue;
        }

        if (value === undefined || value === null) {
          return false;
        }
        if ((value as string | number) < (constraint.value as string | number)) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...docs].sort((left, right) => {
      const hasNormalized = left.normalizedName !== undefined || right.normalizedName !== undefined;
      if (hasNormalized) {
        const a = String(left.normalizedName ?? "");
        const b = String(right.normalizedName ?? "");
        return a.localeCompare(b);
      }

      const a = Number(left.createdAt ?? left._creationTime);
      const b = Number(right.createdAt ?? right._creationTime);
      return a - b;
    });

    if (this.direction === "desc") {
      sorted.reverse();
    }

    return sorted;
  }
}

class InMemoryDB {
  private readonly tables = new Map<string, Map<string, AnyDoc>>();
  private readonly counters = new Map<string, number>();

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
}

export const createMockConvexMutationCtx = () => {
  const db = new InMemoryDB();
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
      getUrl: async (storageId: string) => `https://convex.test/storage/${storageId}`,
    },
  };

  return { ctx, db };
};
