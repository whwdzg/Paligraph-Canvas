---
title: LaTeX 渲染测试
---

# LaTeX 渲染测试

行内公式：$E = mc^2$，以及 Obsidian 的 \\(a^2 + b^2 = c^2\\)。

块级公式：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

矩阵：

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$

代码中的 `$not math$` 不应该渲染：

```text
$E = mc^2$
```

> [!tip] 提示
> 公式在阅读卡片中直接用 KaTeX 渲染。
