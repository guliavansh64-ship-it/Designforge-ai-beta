import { describe, expect, it, vi } from 'vitest';
import { StitchError } from '@google/stitch-sdk';

vi.mock('../src/services/connections.js', () => ({ markConnection: vi.fn(async () => undefined), getCredential: vi.fn() }));
const { __test, clarificationFollowUp, mapStitchError } = await import('../src/services/stitch.js');

const QUESTION = 'I propose a core **4-screen flow**:\n1. **Dashboard**\n2. **Workout Tracker**\n### Design Foundation\nWould you like me to proceed with this 4-screen architecture?';
const clarify = () => new StitchError({ code: 'CLARIFICATION_REQUIRED', message: 'q', recoverable: true,
  clarification: { question: QUESTION, suggestions: ['Focus on strength training', 'Yes, proceed with the proposed 4 screens', 'Make it light'] } });

describe('Stitch clarification questions are answered automatically', () => {
  it('answers with the "yes/proceed" suggestion, keeps the proposal, and asks for one screen', () => {
    const p = clarificationFollowUp('A fitness app', QUESTION, ['Focus on strength training', 'Yes, proceed with the proposed 4 screens']);
    expect(p.startsWith('A fitness app')).toBe(true);
    expect(p).toContain('My answer: Yes, proceed with the proposed 4 screens');
    expect(p).toContain('Dashboard');
    expect(p).not.toContain('**');
    expect(p).toMatch(/ONLY the first\/main one/);
    expect(p).toMatch(/Do not ask clarifying questions/);
  });

  it('retries after a question and returns the design', async () => {
    const run = vi.fn().mockRejectedValueOnce(clarify()).mockResolvedValueOnce('DESIGN');
    await expect(__test.withClarificationRetry('A fitness app', run)).resolves.toBe('DESIGN');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toContain('My answer: Yes, proceed');
  });

  it('gives up after 2 follow-ups with a short, readable error', async () => {
    const run = vi.fn().mockRejectedValue(clarify());
    const e = await __test.withClarificationRetry('x', run).catch((err) => err);
    expect(run).toHaveBeenCalledTimes(3);
    const mapped = await mapStitchError(undefined, e);
    expect(mapped.status).toBe(422);
    expect(mapped.message).toContain('Would you like me to proceed');
    expect(mapped.message).not.toContain('**');
    expect(mapped.message.length).toBeLessThan(700);
  });

  it('does not retry other errors', async () => {
    const run = vi.fn().mockRejectedValue(new StitchError({ code: 'RATE_LIMITED', message: 'slow down', recoverable: true }));
    await expect(__test.withClarificationRetry('x', run)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
