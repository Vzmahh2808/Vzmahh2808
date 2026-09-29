/**
 * Starts the agent arena HTTP API. Run with: npm run arena   (PORT, default 8787)
 */
import { createArenaServer } from "./arena-server";

const port = Number(process.env.PORT ?? 8787);
createArenaServer().listen(port, () => {
  console.log(`Арена агентов слушает http://localhost:${port}`);
});
