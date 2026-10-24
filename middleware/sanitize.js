// Strips MongoDB operator keys ($where, $ne, ...) and dotted keys from request bodies
// so user input can never be interpreted as a query operator.
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
      } else {
        value[key] = clean(value[key]);
      }
    }
  }
  return value;
};

export const sanitizeBody = (req, res, next) => {
  if (req.body) clean(req.body);
  next();
};
