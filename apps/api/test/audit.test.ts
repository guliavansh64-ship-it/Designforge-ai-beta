import { describe, expect, it } from 'vitest';
import { auditHtml, buildImprovementPlan, compareAudits, contrastRatio, enrichPrompt } from '../src/services/audit.js';
import { renderTemplate, TEMPLATE_SPECS } from '../src/scripts/templates.js';

const BAD = `<html><head></head><body><div style="width:1200px"><h2>Title</h2><h4>Skip</h4>
<img src="a.png"><button><svg></svg></button><input type="text"><p style="color:#aaaaaa">low contrast</p>
<a>dead</a><div onclick="x()">x</div><script src="https://evil.example/t.js"></script></div></body></html>`;

describe('heuristic design audit', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')!).toBeLessThan(4.5);
  });
  it('flags real problems in a poor design', () => {
    const a = auditHtml(BAD, 'website');
    const failed = new Set(a.checks.filter((c) => !c.passed).map((c) => c.id));
    for (const id of ['viewport', 'single_h1', 'heading_order', 'img_alt', 'control_names', 'form_labels', 'contrast', 'fixed_width', 'dead_links', 'inline_handlers', 'external_scripts', 'lang', 'section_footer']) {
      expect(failed, id).toContain(id);
    }
    expect(a.score).toBeLessThan(40);
    expect(a.methodology).toMatch(/not an industry-standard/);
  });
  it('all built-in templates pass ≥ 90', () => {
    for (const t of TEMPLATE_SPECS) {
      const a = auditHtml(renderTemplate(t), t.kind ?? 'website', t.deviceType ?? 'DESKTOP');
      expect(a.score, `${t.id}: ${a.checks.filter((c) => !c.passed).map((c) => c.id)}`).toBeGreaterThanOrEqual(90);
    }
  });
  it('builds a prioritised improvement plan and compares versions', () => {
    const before = auditHtml(BAD, 'website');
    const plan = buildImprovementPlan(before, 'Make it feel premium');
    expect(plan.items[0].severity).toBe('high');
    expect(plan.prompt).toContain('premium');
    const after = auditHtml(renderTemplate(TEMPLATE_SPECS[0]), 'website');
    const cmp = compareAudits(before, after);
    expect(cmp.scoreDelta).toBeGreaterThan(40);
    expect(cmp.fixed.length).toBeGreaterThan(5);
  });
  it('enriches website prompts with structure requirements', () => {
    expect(enrichPrompt('Gym site', 'website', { category: 'Gym' })).toMatch(/navigation.*hero.*footer/s);
  });
});
