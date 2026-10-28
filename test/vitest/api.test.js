import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../app.js";

describe("GET /api", () => {
  it("should return a 200 status code and a JSON response", async () => {
    const res = await request(app).get("/api");

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("message");
  });
});
