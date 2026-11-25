import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The component has no translation prop for this screen-reader close label.
for (const extension of ['js', 'mjs']) {
  const path = resolve(`node_modules/@base-ui/react/combobox/utils/ComboboxInternalDismissButton.${extension}`);
  if (existsSync(path)) {
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, source.replace('"aria-label": "Dismiss"', '"aria-label": "关闭选项列表"'));
  }
}
