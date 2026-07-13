import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COMPANY_LANGUAGE,
  inferPreferredLanguageFromText,
  normalizePreferredLanguage,
  resolvePreferredLanguage,
} from "../../src/runtime/language/preferred-language.js";

test("preferred language inference follows the message language", () => {
  assert.equal(inferPreferredLanguageFromText("请帮我创建一个任务。"), "zh-CN");
  assert.equal(inferPreferredLanguageFromText("Please create a task for this."), "en-US");
  assert.equal(inferPreferredLanguageFromText("タスクを作成してください。"), "ja");
  assert.equal(inferPreferredLanguageFromText("작업을 만들어 주세요."), "ko");
  assert.equal(inferPreferredLanguageFromText("12345"), undefined);
});

test("preferred language resolution honors explicit value before inference and defaults", () => {
  assert.equal(normalizePreferredLanguage(" en-US "), "en-US");
  assert.equal(normalizePreferredLanguage("not a language tag"), undefined);
  assert.equal(resolvePreferredLanguage({
    explicit: "en-GB",
    text: "请帮我处理。",
    env: {},
  }), "en-GB");
  assert.equal(resolvePreferredLanguage({
    text: "No local hint here.",
    env: { TINYOFFICE_DEFAULT_LANGUAGE: "fr-FR" },
  }), "en-US");
  assert.equal(resolvePreferredLanguage({
    text: "",
    env: { TINYOFFICE_DEFAULT_LANGUAGE: "fr-FR" },
  }), "fr-FR");
  assert.equal(resolvePreferredLanguage({
    text: "",
    env: {},
  }), DEFAULT_COMPANY_LANGUAGE);
});
