// API shapes, written by hand from the public docs at https://docs.bookmark.land/docs
// and the "API contract" list in the spec issue (#3).

export interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

export interface Me {
  userId: string;
  name: string | null;
  email: string | null;
  plan: string;
  status: string;
}

// Device login responses are not wrapped in `data`.
export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceToken {
  access_token: string;
  token_type: string;
  scopes: string[];
}

export type BookmarkType = "link" | "article" | "image" | "video" | "document";

// Fields with no value are left out by the API.
export interface Bookmark {
  id: string;
  url: string;
  title?: string;
  description?: string;
  excerpt?: string;
  note?: string;
  type?: BookmarkType;
  isFavorite?: boolean;
  tags?: string[];
  collectionId?: string | null;
  domain?: string;
  favicon?: string;
  coverImage?: string | null;
  clickCount?: number;
  metadataStatus?: string;
  linkStatus?: string;
  lastCheckedAt?: string;
  httpStatusCode?: number;
  lastCheckErrorKind?: string;
  embeddable?: boolean;
  siteRisk?: { level: string; findingCount: number };
  savedAt?: string;
  createdAt?: string;
}

export interface BookmarkPage {
  data: Bookmark[];
  cursor: string | null;
  hasMore: boolean;
  truncated: boolean;
}

// Creating a Bookmark returns its id, not the Bookmark. A URL that is already saved is saved again.
export interface CreatedBookmark {
  bookmarkId: string;
  duplicate: boolean;
  restored: boolean;
}
