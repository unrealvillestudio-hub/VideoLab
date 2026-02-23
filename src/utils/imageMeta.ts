export const extractMeta = (data: any) => ({
  timestamp: Date.now(),
  ...data
});
