/**
 * TypeScript types for DA Admin API
 */

export interface DASource {
  name: string;
  path: string;
  ext?: string;
  lastModified?: number;
}

// The list API returns a flat array of DASource objects
export type DAListSourcesResponse = DASource[];

export interface DASourceContent {
  path: string;
  content: string;
  contentType?: string;
  lastModified?: string;
  etag?: string;
}

export interface DAVersion {
  timestamp: number;
  path: string;
  url?: string;
  users: { email: string }[];
}

export interface DAVersionsResponse {
  versions: DAVersion[];
}

export interface DAConfig {
  [key: string]: any;
}

export interface DAMediaReference {
  path: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface DAMediaContent {
  data: string; // base64-encoded binary data
  mimeType: string;
}

export interface DAFragmentReference {
  path: string;
  fragment: string;
  content?: string;
}

export interface DAOperationResponse {
  success: boolean;
  message?: string;
  path?: string;
}

export interface DAAdminClientOptions {
  apiToken: string;
  daadminService: Fetcher;
  timeout?: number;
}

export interface DAAPIError {
  status: number;
  message: string;
  details?: any;
}
