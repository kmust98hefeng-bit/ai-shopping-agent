export function fail(status, error, extra = {}) {
  const err = new Error(error);
  err.status = status;
  err.extra = extra;
  Object.assign(err, extra);
  return err;
}
