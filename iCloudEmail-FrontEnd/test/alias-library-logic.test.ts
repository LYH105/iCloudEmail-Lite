import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountPublic, AliasPublic, MarkRule } from '../src/types';
import {
  COMPLETE_MARK_FILTER,
  buildAliasLibraryModel,
  isAliasComplete,
  latestAliasHitAt,
} from '../src/features/aliases/libraryLogic';

const account: AccountPublic = {
  id: 'account-1',
  label: '工作账户',
  appleId: 'owner@icloud.com',
  dsid: null,
  webserviceUrl: null,
  china: true,
  status: 'active',
  lastError: null,
  hasPassword: true,
  autoCreateEnabled: false,
  disabled: false,
  hasImap: true,
  imapUsername: 'owner@icloud.com',
  imapAuthFailed: false,
  createdAt: 1,
  updatedAt: 1,
};

function alias(id: string, marks: AliasPublic['marks'], createTimestamp: number): AliasPublic {
  return {
    id,
    accountId: account.id,
    anonymousId: `anonymous-${id}`,
    hme: `${id}@icloud.com`,
    domain: 'icloud.com',
    forwardToEmail: account.appleId,
    label: id === 'one' ? '注册池' : null,
    note: null,
    origin: null,
    isActive: true,
    recipientMailId: null,
    createTimestamp,
    syncedAt: 1,
    marks,
    used: false,
    usedAt: null,
  };
}

const rules: MarkRule[] = [
  {
    id: 'r1',
    mark: '已注册',
    fromContains: null,
    subjectContains: 'welcome',
    bodyContains: null,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'r2',
    mark: '已开通',
    fromContains: null,
    subjectContains: 'active',
    bodyContains: null,
    enabled: true,
    createdAt: 2,
    updatedAt: 2,
  },
];

const first = alias(
  'one',
  [
    { mark: '已注册', hitAt: 100, source: null },
    { mark: '已开通', hitAt: 200, source: null },
  ],
  10,
);
const second = alias(
  'two',
  [
    { mark: '已注册', hitAt: 300, source: null },
    { mark: '已开通', hitAt: 400, source: null },
  ],
  20,
);

test('account search matches Apple ID and friendly account label', () => {
  for (const query of ['owner@icloud.com', '工作账户']) {
    const model = buildAliasLibraryModel([account], [first], rules, {
      accountId: '',
      mark: '',
      query,
    });
    assert.deepEqual(
      model.shown.map((item) => item.id),
      ['one'],
    );
  }
});

test('complete filter uses configured stage order and newest completion first', () => {
  const model = buildAliasLibraryModel([account], [first, second], rules, {
    accountId: '',
    mark: COMPLETE_MARK_FILTER,
    query: '',
  });
  assert.equal(isAliasComplete(first, model.enabledMarks), true);
  assert.equal(latestAliasHitAt(first, model.enabledMarks), 200);
  assert.deepEqual(
    model.shown.map((item) => item.id),
    ['two', 'one'],
  );
});
