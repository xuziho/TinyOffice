declare module "typebox" {
  export const Type: {
    String(options?: Record<string, unknown>): unknown;
    Array(item: unknown, options?: Record<string, unknown>): unknown;
    Object(properties: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  };
}
