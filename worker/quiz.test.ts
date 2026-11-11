import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_KNOWLEDGE, EXAM_SITUATIONS, canAccess, correctDisplayed, cryptoRandomInt,
  displayedOptions, firstUnanswered, isCorrect, makeItems, pickQuestionIds, shuffle, type PoolEntry,
} from './quiz.ts';

const pool: PoolEntry[] = [
  ...Array.from({ length: 100 }, (_, i) => ({ id: i + 1, kind: 'knowledge' as const })),
  ...Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, kind: 'situation' as const })),
];

test('cryptoRandomInt reste dans les bornes', () => {
  for (let i = 0; i < 2000; i++) {
    const v = cryptoRandomInt(7);
    assert.ok(v >= 0 && v < 7 && Number.isInteger(v));
  }
  assert.throws(() => cryptoRandomInt(0));
});

test('shuffle conserve les éléments', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual([...shuffle(a)].sort(), a);
});

test("l'examen blanc respecte 28 connaissances + 12 mises en situation, sans doublon", () => {
  const ids = pickQuestionIds(pool, { exam: true, size: 0 });
  assert.equal(ids.length, EXAM_KNOWLEDGE + EXAM_SITUATIONS);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id >= 1000).length, EXAM_SITUATIONS);
});

test('le mode libre respecte la taille demandée', () => {
  assert.equal(pickQuestionIds(pool, { exam: false, size: 20 }).length, 20);
});

test('la bonne réponse (option 0) est retrouvée après mélange', () => {
  const options = ['BONNE', 'b', 'c', 'd'];
  for (const item of makeItems([1, 2, 3, 4, 5, 6, 7, 8])) {
    const shown = displayedOptions(item, options);
    const k = correctDisplayed(item);
    assert.equal(shown[k], 'BONNE');
    assert.ok(isCorrect(item, k));
    assert.equal(shown.filter((_, j) => isCorrect(item, j)).length, 1);
  }
});

test("la position de la bonne réponse varie (pas toujours la première)", () => {
  const positions = new Set(makeItems(Array.from({ length: 200 }, (_, i) => i)).map(correctDisplayed));
  assert.equal(positions.size, 4);
});

test('on ne peut pas sauter de question', () => {
  const answers = [0, 2, null, null];
  assert.equal(firstUnanswered(answers), 2);
  assert.ok(canAccess(answers, 0));
  assert.ok(canAccess(answers, 2));
  assert.ok(!canAccess(answers, 3));
  assert.ok(!canAccess(answers, -1));
  assert.ok(!canAccess(answers, 1.5));
  assert.ok(!canAccess(answers, 4));
});
