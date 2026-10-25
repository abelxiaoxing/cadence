/** WebUI language. English source text is the default and the fallback; an
 * explicit choice is remembered only in this browser, never on the owner. */
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { zh } from "./zh";

export type Locale = "en" | "zh";
export type MessageKey = keyof typeof zh;
export type Vars = Readonly<Record<string, string | number>>;
export interface Translator {
  locale: Locale;
  /** Fixed interface text; the type keeps every key in the Chinese catalog. */
  t(key: MessageKey, vars?: Vars): string;
  /** Text known only at run time (status words, kept notices); unknown text stays as is. */
  tx(text: string): string;
  setLocale(locale: Locale): void;
}
export const LOCALE_STORAGE_KEY = "cadence-locale";
const chinese: ReadonlyMap<string, string> = new Map(Object.entries(zh));

export function translate(locale: Locale, text: string, vars?: Vars): string {
  const template = locale === "zh" ? (chinese.get(text) ?? text) : text;
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.hasOwn(vars, name) ? String(vars[name]) : match,
      )
    : template;
}
/** A translated sentence with nodes (code spans) at its `{name}` marks. */
export function Template({
  text,
  slots,
}: {
  text: string;
  slots: Readonly<Record<string, ReactNode>>;
}) {
  return text
    .split(/\{(\w+)\}/)
    .map((part, i) =>
      i % 2 === 0 ? (
        part
      ) : (
        <Fragment key={part}>
          {Object.hasOwn(slots, part) ? slots[part] : `{${part}}`}
        </Fragment>
      ),
    );
}
/** A saved explicit choice, else the browser's first preferred language. */
export function preferredLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {}
  const first =
    typeof navigator === "undefined"
      ? undefined
      : (navigator.languages?.[0] ?? navigator.language);
  return first?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
function translator(
  locale: Locale,
  setLocale: (locale: Locale) => void,
): Translator {
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    tx: (text) => translate(locale, text),
    setLocale,
  };
}
const LocaleContext = createContext<Translator>(translator("en", () => {}));
export function useT(): Translator {
  return useContext(LocaleContext);
}
export function LocaleProvider({
  initial,
  children,
}: {
  initial?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(
    () => initial ?? preferredLocale(),
  );
  const value = useMemo(
    () =>
      translator(locale, (next) => {
        // Written only on an explicit choice, so a first load stores nothing.
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {}
        setLocale(next);
      }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = translate(locale, "Cadence task workspace");
  }, [locale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
