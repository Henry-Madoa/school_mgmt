/*
 * Next.js ships declarations for `*.module.css` only. TypeScript 6 rejects a
 * side-effect import of a module it has no declaration for, which is exactly
 * what `import './globals.css'` in the root layout is — so declare the plain
 * stylesheet form here.
 */
declare module '*.css';
