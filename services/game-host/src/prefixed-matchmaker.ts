import {
  createAuthContext,
  createEndpoint,
  createRouter,
  matchMaker,
  type Transport,
} from "@colyseus/core";

export function createPrefixedMatchmakerRouter(basePath: string, transport: Transport) {
  const endpoint = createEndpoint(
    `${basePath}/matchmake/:method/:roomName`,
    { method: "POST" },
    async (context) => {
      const method = context.params.method;
      const roomName = context.params.roomName;
      const request = context.request;
      if (method === undefined || roomName === undefined || request === undefined) {
        throw context.error("BAD_REQUEST");
      }
      try {
        const response = await matchMaker.controller.invokeMethod(
          method,
          roomName,
          context.body,
          createAuthContext({ headers: request.headers, req: request }),
        );
        if (transport.protocol !== undefined) response.protocol = transport.protocol;
        if (transport.fingerprint !== undefined) response.fingerprint = transport.fingerprint;
        return Response.json(response);
      } catch (error) {
        const failure = error as { readonly code?: number; readonly message?: string };
        const status = failure.code !== undefined && failure.code >= 400 && failure.code <= 599
          ? failure.code
          : 400;
        throw context.error(status as Parameters<typeof context.error>[0], {
          ...(failure.code === undefined ? {} : { code: String(failure.code) }),
          error: failure.message ?? "matchmaking_failed",
        });
      }
    },
  );
  return createRouter({ prefixedMatchmake: endpoint }, { openapi: { disabled: true } });
}
