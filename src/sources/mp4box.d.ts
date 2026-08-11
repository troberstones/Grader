/**
 * Minimal declarations for mp4box.js — it ships no types and we touch a small
 * corner of it: demux to samples, and dig out the codec description box.
 */
declare module "mp4box" {
  export interface MP4VideoTrack {
    id: number;
    nb_samples: number;
    timescale: number;
    duration: number;
    codec: string;
    video: { width: number; height: number };
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4VideoTrack[];
  }

  export interface MP4Sample {
    number: number;
    is_sync: boolean;
    timescale: number;
    cts: number;
    dts: number;
    duration: number;
    data: Uint8Array;
  }

  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export class DataStream {
    static BIG_ENDIAN: number;
    static LITTLE_ENDIAN: number;
    constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: number);
    buffer: ArrayBuffer;
  }

  export interface MP4File {
    onReady: (info: MP4Info) => void;
    onError: (e: string) => void;
    onSamples: (id: number, user: unknown, samples: MP4Sample[]) => void;
    appendBuffer(data: MP4ArrayBuffer): number;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(id: number, user?: unknown, options?: { nbSamples?: number }): void;
    getTrackById(id: number): {
      mdia: {
        minf: {
          stbl: {
            stsd: {
              entries: Array<Record<string, { write(stream: DataStream): void } | undefined>>;
            };
          };
        };
      };
    };
  }

  export function createFile(): MP4File;
}
