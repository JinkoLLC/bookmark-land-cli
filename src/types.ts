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
