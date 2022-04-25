---
layout: post
title: JavaScript下载文件
excerpt: 曲线救国下载文件
date: 2022-03-10
tags:
  - post
  - skill
---

## 步骤概要

- 创建 `<a>` 标签（或 `window.open('', '_blank')` 控制打开的 tab）
- 设置它的 `href` 属性
- 设置它的 `download` 属性（有浏览器版本限制）
- 用 `JavaScript` 来触发这个它的 `click` 事件（`click` 事件不一定对所有浏览器都适用）

### 点击事件的兼容

```typescript
// `a.click()` doesn't work for all browsers (#465)
const click = (node: HTMLElement) => {
  try {
    node.dispatchEvent(new MouseEvent('click'));
  } catch (e) {
    const evt = document.createEvent('MouseEvents');
    evt.initMouseEvent(
      'click',
      true,
      true,
      window,
      0,
      0,
      0,
      80,
      20,
      false,
      false,
      false,
      false,
      0,
      null
    );
    node.dispatchEvent(evt);
  }
};
```

### 下载文件

```typescript
const a = document.createElement('a');
const url = window.URL.createObjectURL(blob);
const filename = 'what-you-want.txt';
a.href = url;
a.download = filename;
click(a);
window.URL.revokeObjectURL(url); // 从内存中释放资源
```

### 从 URL 下载文件

```typescript
const download = (url: string, name: string, opts) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'blob';
  xhr.onload = function () {
    // saveAs(xhr.response, name)
  };
  xhr.onerror = function () {
    console.error('could not download file');
  };
  xhr.send();
};
```
