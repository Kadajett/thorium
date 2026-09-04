import { loadEnvironment } from "./config.js";
import {
  createPlatformDependencies,
  createPlatformServer,
} from "./platform.js";

const environment = loadEnvironment(process.env);

export default createPlatformServer(createPlatformDependencies(environment), {
  browserAllowedOrigins: environment.BROWSER_ALLOWED_ORIGINS,
});
