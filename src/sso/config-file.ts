/**
 *
 */
interface SectionRange {
  start: number;
  end: number;
}

const sectionHeader = (name: string): string => `[${name}]`;

const findSection = (
  lines: string[],
  name: string
): SectionRange | undefined => {
  const header = sectionHeader(name);
  const start = lines.findIndex(line => line.trim() === header);
  if (start === -1) {
    return undefined;
  }
  const relativeNext = lines
    .slice(start + 1)
    .findIndex(line => line.trim().startsWith("["));
  const end = relativeNext === -1 ? lines.length : start + 1 + relativeNext;
  return { start, end };
};

const parseKey = (line: string): string | undefined => {
  const index = line.indexOf("=");
  return index === -1 ? undefined : line.slice(0, index).trim();
};

const getKey = (
  configText: string,
  section: string,
  key: string
): string | undefined => {
  const lines = configText.split("\n");
  const range = findSection(lines, section);
  if (!range) {
    return undefined;
  }
  const match = lines
    .slice(range.start + 1, range.end)
    .find(line => parseKey(line) === key);
  return match ? match.slice(match.indexOf("=") + 1).trim() : undefined;
};

const setKey = (
  configText: string,
  section: string,
  key: string,
  value: string
): string => {
  const lines = configText.split("\n");
  const range = findSection(lines, section);
  const entry = `${key} = ${value}`;
  if (!range) {
    return [...lines, sectionHeader(section), entry].join("\n");
  }
  const relativeKey = lines
    .slice(range.start + 1, range.end)
    .findIndex(line => parseKey(line) === key);
  if (relativeKey !== -1) {
    const absolute = range.start + 1 + relativeKey;
    return lines.map((line, i) => (i === absolute ? entry : line)).join("\n");
  }
  return [
    ...lines.slice(0, range.start + 1),
    entry,
    ...lines.slice(range.start + 1),
  ].join("\n");
};

/**
 * Build the IAM Identity Center start URL for a domain.
 * @param domain - The domain without scheme or path (e.g. "acme").
 * @returns The full start URL.
 */
export const computeStartUrl = (domain: string): string =>
  `https://${domain}.awsapps.com/start`;

/** The result of updating a config's SSO start URL. */
export interface StartUrlUpdate {
  content: string;
  targetSection: string;
  url: string;
}

/**
 * Update the SSO start URL for a profile in AWS CLI config text. If the profile
 * uses an `sso_session`, the URL is set on that session section (matching the
 * `aws configure sso` layout); otherwise it is set directly on the profile.
 * Pure: returns new config text rather than mutating a file.
 * @param configText - The current AWS config file contents.
 * @param profile - The profile name (or "default").
 * @param domain - The Identity Center domain.
 * @returns The updated content, the section changed, and the URL written.
 */
export const applyStartUrl = (
  configText: string,
  profile: string,
  domain: string
): StartUrlUpdate => {
  const url = computeStartUrl(domain);
  const profileSection =
    profile === "default" ? "default" : `profile ${profile}`;
  const ssoSession = getKey(configText, profileSection, "sso_session");
  const targetSection = ssoSession
    ? `sso-session ${ssoSession}`
    : profileSection;
  const content = setKey(configText, targetSection, "sso_start_url", url);
  return { content, targetSection, url };
};
