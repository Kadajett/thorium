import app from "./app.config.js";
import { loadEnvironment } from "./config.js";

const environment = loadEnvironment(process.env);
await app.listen(environment.PORT);
