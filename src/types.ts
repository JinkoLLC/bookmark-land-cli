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
