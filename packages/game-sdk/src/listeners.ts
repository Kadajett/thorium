/** Effect adapter: mutable subscriptions never enter the functional core. */
interface Listeners<T> {
  readonly listen: (listener: (event: T) => void) => () => void;
  readonly emit: (event: T) => void;
}

export function createListeners<T>(): Listeners<T> {
  const listeners = new Set<(event: T) => void>();
  return {
    listen(listener: (event: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: T): void {
      listeners.forEach((listener) => {
        listener(event);
      });
    },
  };
}

function channelListeners<T>(channels: Map<string, Listeners<T>>, channel: string): Listeners<T> {
  const listeners = channels.get(channel) ?? createListeners<T>();
  channels.set(channel, listeners);
  return listeners;
}

interface Channels<T> {
  readonly listen: (channel: string, listener: (event: T) => void) => () => void;
  readonly emit: (channel: string, event: T) => void;
}

export function createChannels<T>(): Channels<T> {
  const channels = new Map<string, Listeners<T>>();
  return {
    listen(channel: string, listener: (event: T) => void): () => void {
      return channelListeners(channels, channel).listen(listener);
    },
    emit(channel: string, event: T): void {
      channels.get(channel)?.emit(event);
    },
  };
}
