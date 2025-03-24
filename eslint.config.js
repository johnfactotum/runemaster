import js from '@eslint/js'
import globals from 'globals'

export default [js.configs.recommended, {
    languageOptions: {
        globals: {
            ...globals.browser,
            Deno: 'readonly',
        },
    },
    linterOptions: {
        reportUnusedDisableDirectives: true,
    },
    rules: {
        semi: ['error', 'never'],
        indent: ['error', 4, { flatTernaryExpressions: true, SwitchCase: 1 }],
        quotes: ['error', 'single', { avoidEscape: true }],
        'comma-dangle': ['error', 'always-multiline'],
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-empty': ['error', { allowEmptyCatch: true }],
    },
}]
