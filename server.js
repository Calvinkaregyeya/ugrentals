import { app } from "./app.js";

const port = process.env.PORT ?? 3000;
const host = process.env.HOST ?? "0.0.0.0";

app.listen(port, host, () => {
  console.log(`UG Rentals listening on http://${host}:${port}`);
});
