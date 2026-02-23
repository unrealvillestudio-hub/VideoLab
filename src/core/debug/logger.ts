export const logDebug = (msg: string, data?: any) => {
  console.log(`[DEBUG] ${msg}`, data || '');
};
