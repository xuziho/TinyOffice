export function validateSkillMarkdown(skillName: string, content: string): void {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error("SKILL.md must begin with YAML frontmatter.");
  }
  const name = match[1]?.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
  const description = match[1]?.match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim();
  if (name !== skillName) {
    throw new Error(`SKILL.md frontmatter name must equal ${skillName}.`);
  }
  if (!description) {
    throw new Error("SKILL.md frontmatter requires a non-empty description.");
  }
}
