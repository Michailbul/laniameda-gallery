// Detects audio a browser cannot decode, so the upload panel can warn before a
// clip lands in the gallery looking perfect and playing silent.
//
// The naive approach — scanning the whole file for a PCM fourcc — does not work:
// a 190 MB AAC clip in this repo's own test material contains a stray `twos`
// byte sequence inside the compressed video payload. So this walks the top-level
// box structure to find `moov` (which sits at the END of non-faststart .mov
// exports, the exact files that carry PCM) and only inspects bytes inside it.
// moov holds no media payload, so a fourcc read there is trustworthy.

// QuickTime/MP4 sample-entry formats that mean raw PCM. Browsers decode none of
// them inside an MP4/MOV container.
const PCM_SAMPLE_ENTRIES = new Set([
  "sowt", "twos", "in24", "in32", "fl32", "fl64", "raw ", "lpcm", "ipcm", "alaw", "ulaw",
]);

// Read a byte range. Backed by File.slice in the browser, by a Buffer in tests.
export type ByteRangeReader = (start: number, length: number) => Promise<Uint8Array>;

const MAX_MOOV_BYTES = 16 * 1024 * 1024;

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

async function locateMoov(
  read: ByteRangeReader,
  fileSize: number,
): Promise<{ offset: number; size: number } | undefined> {
  let position = 0;
  // Guard against a malformed file walking forever on zero-size boxes.
  for (let hops = 0; hops < 512 && position + 8 <= fileSize; hops += 1) {
    const header = await read(position, 16);
    if (header.length < 8) return undefined;

    let size = readU32(header, 0);
    const type = fourcc(header, 4);
    let headerLength = 8;

    if (size === 1) {
      // 64-bit extended size. Only the low 32 bits can matter at these scales.
      if (header.length < 16) return undefined;
      size = readU32(header, 8) * 2 ** 32 + readU32(header, 12);
      headerLength = 16;
    } else if (size === 0) {
      size = fileSize - position;
    }

    if (size < headerLength) return undefined;
    if (type === "moov") {
      return { offset: position + headerLength, size: size - headerLength };
    }
    position += size;
  }
  return undefined;
}

// Every track's sample-entry format (e.g. "avc1", "mp4a", "in24"). Video entries
// are harmless here — they simply never match the PCM set.
export function sampleEntryFormats(moov: Uint8Array): string[] {
  const formats: string[] = [];
  for (let i = 0; i + 20 <= moov.length; i += 1) {
    if (
      moov[i] === 0x73 && // s
      moov[i + 1] === 0x74 && // t
      moov[i + 2] === 0x73 && // s
      moov[i + 3] === 0x64 // d
    ) {
      // stsd: type(4) version+flags(4) entryCount(4) then entry size(4) format(4)
      const formatOffset = i + 16;
      if (formatOffset + 4 <= moov.length) formats.push(fourcc(moov, formatOffset));
    }
  }
  return formats;
}

export function formatsIncludeUndecodableAudio(formats: string[]): boolean {
  return formats.some((format) => PCM_SAMPLE_ENTRIES.has(format));
}

export type AudioCheck = {
  /** True only when a PCM sample entry was positively identified. */
  hasUndecodableAudio: boolean;
  /** False when the container could not be parsed — treat as "unknown". */
  inspected: boolean;
  formats: string[];
};

export async function inspectAudioCodecs(
  read: ByteRangeReader,
  fileSize: number,
): Promise<AudioCheck> {
  try {
    const moovBox = await locateMoov(read, fileSize);
    if (!moovBox || moovBox.size <= 0) {
      return { hasUndecodableAudio: false, inspected: false, formats: [] };
    }
    const moov = await read(moovBox.offset, Math.min(moovBox.size, MAX_MOOV_BYTES));
    const formats = sampleEntryFormats(moov);
    return {
      hasUndecodableAudio: formatsIncludeUndecodableAudio(formats),
      inspected: formats.length > 0,
      formats,
    };
  } catch {
    return { hasUndecodableAudio: false, inspected: false, formats: [] };
  }
}

export async function inspectVideoFileAudio(file: Blob): Promise<AudioCheck> {
  const read: ByteRangeReader = async (start, length) =>
    new Uint8Array(await file.slice(start, start + length).arrayBuffer());
  return inspectAudioCodecs(read, file.size);
}

export const UNDECODABLE_AUDIO_WARNING =
  "This clip's audio is uncompressed PCM, which browsers cannot decode — it will " +
  "upload fine and then play silent. Re-export as MP4 with AAC audio, or ingest it " +
  "with the gallery CLI, which remuxes automatically.";
