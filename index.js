'use strict';

/**
 * Extract critical CSS
 * Based on npm:inline-critical-css
 */

const _ = require('lodash');
const cssParser = require('css');
const htmlParser = require('fast-html-parser');

function walk(tree, combinations) {
  if (tree.tagName) {
    let classes = [];
    if (tree.classNames && tree.classNames.length) {
      _.forEach(
        tree.classNames,
        item => {
          item = _.trim(_.replace(item, /["']/ig, ''));
          if (item)
            classes.push(`.${item}`);
        }
      );
    }
    combinations.push({
      tag: tree.tagName,
      id: tree.id ? `#${tree.id}`: null,
      classes,
    });
  }

  if (!tree.childNodes)
    return;

  for (let node of tree.childNodes)
    walk(node, combinations);
}

function analyze(selector) {
  let result = [];
  let info = {
    tag: null,
    id: null,
    classes: [],
  };

  const update = item => {
    item = _.trim(item);
    if (!item.length)
      return;
    if (item[0] === '#') {
      info.id = item;
    } else if (item[0] === '.') {
      if (!_.includes(info.classes, item))
        info.classes.push(item);
    } else {
      info.tag = item;
    }
  };

  const push = () => {
    if (!info.tag && !info.id && !info.classes.length)
      return;

    result.push(info);
    info = {
      tag: null,
      id: null,
      classes: [],
    };
  };

  let attr = false;
  let pseudo = false;
  let parentheses = 0;
  let cur = '';
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '[') {
      update(cur);
      cur = '';
      attr = true;
      continue;
    }
    if (selector[i] === ']') {
      let classes = cur.match(/^\s*class\s*[~|^$*]?=\s*"([^"]+)".*$/);
      if (classes)
        _.forEach(_.split(classes[1], /\s+/), item => update(`.${item}`));
      cur = '';
      attr = false;
      continue;
    }

    if (attr) {
      cur += selector[i];
      continue;
    }

    if (selector[i] === ':') {
      pseudo = true;
      continue;
    } else if (selector[i] === '(') {
      parentheses++;
      continue;
    } else if (selector[i] === ')') {
      if (--parentheses < 0)
        parentheses = 0;
      continue;
    }

    let next = _.includes([' ', '>', '+', '~'], selector[i]);
    let idClass = _.includes(['.', '#'], selector[i]);
    let asterisk = (selector[i] === '*');

    if (pseudo && !parentheses && (next || idClass || asterisk))
      pseudo = false;

    if (pseudo)
      continue;

    if (next || idClass || asterisk) {
      update(cur);
      cur = '';
      if (next)
        push();
      else if (idClass)
        cur += selector[i];
    } else {
      cur += selector[i];
    }
  }
  update(cur);
  push();
  return result;
}

function match(selector, combinations) {
  let info = analyze(selector);
  if (!info.length)
    return true;

  return _.every(
    info,
    sub => _.some(
      combinations,
      item => {
        if (sub.tag && item.tag !== sub.tag)
          return false;
        if (sub.id && item.id !== sub.id)
          return false;
        if (!sub.classes.length)
          return true;
        return _.every(sub.classes, i => _.includes(item.classes, i));
      }
    )
  );
}

function filter(css, combinations, compress) {
  function reduce(arr, rule) {
    if (rule.type === 'media') {
      rule.rules = _.reduce(rule.rules, reduce, []);
      if (rule.rules.length)
        arr.push(rule); // Don't push empty media queries
      return arr;
    } else if (rule.type === 'rule') {
      rule.selectors = _.reduce(
        rule.selectors,
        (result, selector) => {
          if (match(selector, combinations))
            result.push(selector);
          return result;
        },
        []
      );
      if (rule.selectors.length)
        arr.push(rule);
    }
    return arr;
  }

  let tree = cssParser.parse(css);
  let rules = tree.stylesheet.rules;
  tree.stylesheet.rules = _.reduce(rules, reduce, []);
  return cssParser.stringify(tree, { compress });
}

module.exports = function critical(css, html, { compress = true } = {}) {
  let root = htmlParser.parse(html);
  let combinations = [];
  walk(root, combinations);
  return filter(css, combinations, compress);
};
