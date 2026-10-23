import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../app.js";

describe("UG Rentals HTTP API", () => {
  let server;
  let baseUrl;

  // Start the app on port 0 so the OS picks a free port. This avoids
  // clashing with a dev server or with other CI jobs on the same runner.
  before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  // Close the server so the test process can exit cleanly.
  after(() => new Promise((resolve) => server.close(resolve)));

  test("GET /api returns the welcome payload as JSON", async () => {
    const res = await fetch(`${baseUrl}/api`);

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await res.json(), {
      success: true,
      message: "Operation successful",
      data: "Welcome to Osebo API!!!",
    });
  });

  test("GET / serves the landing page", async () => {
    const res = await fetch(`${baseUrl}/`);

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /<html/i);
  });

  test("unknown routes return 404", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);

    assert.equal(res.status, 404);
  });
});
