type Name = "validate" | "pack" | "serve" | "publish";
type Options = Readonly<Record<string, string>>;
export type CliCommand = Readonly<{ name: Name; manifest: string; options: Options }>;
const ALLOWED: Readonly<Record<Name, readonly string[]>> = {
  validate: ["--out"],
  pack: ["--archive", "--descriptor"],
  serve: ["--port"],
  publish: ["--platform"],
};
function commandName(value: string | undefined): value is Name {
  return value !== undefined && Object.hasOwn(ALLOWED, value);
}
type Pair = readonly [string, string];
type Candidate = readonly [string, string | undefined];
function optionValue(value: string | undefined): value is string {
  return value !== undefined && value !== "" && !value.startsWith("--");
}
function validPair(pair: Candidate, allowed: readonly string[]): pair is Pair {
  return allowed.includes(pair[0]) && optionValue(pair[1]);
}
function options(values: readonly string[], allowed: readonly string[]): Options | undefined {
  const pairs = candidates(values);
  if (!pairs.every((pair) => validPair(pair, allowed))) return undefined;
  return Object.fromEntries([...pairs].reverse());
}
function candidates(values: readonly string[]): readonly Candidate[] {
  return values
    .filter((_, index) => index % 2 === 0)
    .map((name, index): Candidate => [name, values[index * 2 + 1]]);
}
export function parseCliArguments(args: readonly string[]): CliCommand | undefined {
  const name = args[0],
    manifest = args[1];
  if (!commandName(name) || manifest === undefined || manifest === "") return undefined;
  return command(name, manifest, args.slice(2));
}
function command(name: Name, manifest: string, values: readonly string[]): CliCommand | undefined {
  const parsed = options(values, ALLOWED[name]);
  if (parsed === undefined) return undefined;
  if (name === "publish" && parsed["--platform"] === undefined) return undefined;
  return { name, manifest, options: parsed };
}
