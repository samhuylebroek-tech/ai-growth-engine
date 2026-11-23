import { describe, expect, it } from "vitest";
import { bodyLimitRefusal, MAX_BODY_BYTES } from "@/lib/request-limits";

const h = (o: Record<string, string>) => new Headers(o);
describe("request body limits", () => {
  it("refuses a server-function body above 1 MB before it is parsed", () => {
    expect(
      bodyLimitRefusal("POST", h({ "content-length": String(MAX_BODY_BYTES + 1) }), "serverFn"),
    ).toEqual({ status: 413, reason: "body too large" });
  });
  it("accepts a normal server-function call", () => {
    expect(bodyLimitRefusal("POST", h({ "content-length": "2048" }), "serverFn")).toBeNull();
  });
  it("refuses a chunked server-function body that declares no length", () => {
    expect(
      bodyLimitRefusal("POST", h({ "transfer-encoding": "chunked" }), "serverFn")?.status,
    ).toBe(411);
  });
  it("refuses a malformed length", () => {
    expect(bodyLimitRefusal("POST", h({ "content-length": "12abc" }), "serverFn")?.status).toBe(
      413,
    );
  });
  it("leaves page loads and reads alone", () => {
    expect(bodyLimitRefusal("GET", h({}), "router")).toBeNull();
    expect(bodyLimitRefusal("POST", h({}), "router")).toBeNull();
  });
});
