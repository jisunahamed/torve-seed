export const TORVE_STREAMING_RESPONSE_HEADER = 'x-torve-streaming';
export const VIDEO_DOWNLOAD_STREAM_HEADER = 'x-torve-video-download';
export const VIDEO_DOWNLOAD_STREAM_VERSION = 'video-stream-v1';
/** Keep the first native-video download path bounded and predictable. */
export const VIDEO_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
export const VIDEO_DOWNLOAD_CHUNK_BYTES = 64 * 1024;
export const TORVE_FAULT_ATTRIBUTION_HEADER = 'x-torve-fault-attribution';
export const TORVE_BUYER_FAULT_ERROR_CODE = 'torve_buyer_fault';
/** Header carrying a pre-signed SpendingAuth for manual payment approval. Base64-encoded JSON. */
export const TORVE_SPENDING_AUTH_HEADER = 'x-torve-spending-auth';
/** Marker header set on HttpRequest frames whose body is sent via HttpRequestChunk/End frames. */
export const TORVE_UPLOAD_CHUNK_HEADER = 'x-torve-upload';
/**
 * Maximum size of a request body that can be sent as a single request frame.
 * Larger bodies are sent as chunked upload frames. WebRTC data channels cap
 * messages at 256 KiB, so this stays below that with headroom for the frame's
 * requestId/method/path/headers.
 */
export const TORVE_UPLOAD_THRESHOLD_BYTES = 240 * 1024;
/**
 * Maximum size of each chunk when sending chunked request uploads.
 * Kept small for cross-peer RTC compatibility where max message size can vary
 * across environments.
 */
export const TORVE_UPLOAD_CHUNK_SIZE = 8 * 1024;

export interface SerializedHttpRequest {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface SerializedHttpResponse {
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
  streamedBody?: { byteLength: number; responseHash: string; videoDurationMs?: number };
}

export interface SerializedHttpResponseChunk {
  requestId: string;
  data: Uint8Array;
  done: boolean;
}

export interface SerializedHttpRequestChunk {
  requestId: string;
  data: Uint8Array;
  done: boolean;
}
