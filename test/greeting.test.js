'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.js'), 'utf8');
const match = source.match(/function getAutoGreeting\(date = new Date\(\)\) \{[\s\S]*?\n\}/);
assert.ok(match, 'getAutoGreeting function must exist');
const context = {};
vm.createContext(context);
vm.runInContext(match[0], context);

function at(hour) {
  return context.getAutoGreeting(new Date(2026, 0, 1, hour, 0, 0));
}

test('automatic greeting changes by local time', () => {
  assert.equal(at(4), '夜深了，注意休息');
  assert.equal(at(5), '早上好，欢迎回来');
  assert.equal(at(8), '早上好，欢迎回来');
  assert.equal(at(9), '上午好，欢迎回来');
  assert.equal(at(11), '上午好，欢迎回来');
  assert.equal(at(12), '中午好，欢迎回来');
  assert.equal(at(13), '中午好，欢迎回来');
  assert.equal(at(14), '下午好，欢迎回来');
  assert.equal(at(17), '下午好，欢迎回来');
  assert.equal(at(18), '晚上好，欢迎回来');
  assert.equal(at(22), '晚上好，欢迎回来');
  assert.equal(at(23), '夜深了，注意休息');
});
