const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i;

export const normalizeEventLink = (value: unknown) => {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (HTTP_PROTOCOL_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  return `https://${trimmedValue.replace(/^\/+/, '')}`;
};

export const normalizeEventLinks = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((item) => normalizeEventLink(item))
    .filter(Boolean)
    .slice(0, 5);
};
