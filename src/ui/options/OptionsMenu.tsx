import { useState, type JSX } from 'react';
import { Box, Text, useInput } from 'ink';
import { Badge, MultiSelect, TextInput } from '@inkjs/ui';
import { COLUMN_KEYS, type ColumnKey, type Config } from '../../domain/types.js';
import { Overlay } from '../Overlay.js';
import { useTheme } from '../theme.js';
import { adjust, editText, formatValue, OPTIONS, parseNumberInput } from './optionsModel.js';

export interface OptionsMenuProps {
  config: Config;
  width: number;
  onChange: (patch: Partial<Config>) => void;
  onClose: () => void;
}

type Mode = 'nav' | 'number' | 'columns';
const LABEL_W = 15;

export function OptionsMenu({ config, width, onChange, onClose }: OptionsMenuProps): JSX.Element {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('nav');
  const desc = OPTIONS[index]!;

  useInput((input, key) => {
    if (mode !== 'nav') {
      if (key.escape) setMode('nav');
      return;
    }
    if (key.escape) onClose();
    else if (key.upArrow || input === 'k') setIndex((i) => (i + OPTIONS.length - 1) % OPTIONS.length);
    else if (key.downArrow || input === 'j') setIndex((i) => (i + 1) % OPTIONS.length);
    else if (key.leftArrow || input === 'h' || key.rightArrow || input === 'l') {
      const patch = adjust(config, desc.key, key.leftArrow || input === 'h' ? -1 : 1);
      if (Object.keys(patch).length > 0) onChange(patch);
    } else if (key.return) {
      if (desc.kind === 'number') setMode('number');
      else if (desc.kind === 'columns') setMode('columns');
      else {
        const patch = adjust(config, desc.key, 1);
        if (Object.keys(patch).length > 0) onChange(patch);
      }
    }
  });

  const submitNumber = (text: string): void => {
    const n = parseNumberInput(desc, text);
    if (n !== undefined) {
      onChange({ [desc.key]: n });
      setMode('nav');
    }
  };

  const editor = (): JSX.Element | null => {
    if (mode === 'number') {
      return <TextInput defaultValue={editText(config, desc)} placeholder="value" onSubmit={submitNumber} />;
    }
    if (mode === 'columns') {
      return (
        <MultiSelect
          options={COLUMN_KEYS.map((c) => ({ label: c, value: c }))}
          defaultValue={config.columns}
          visibleOptionCount={COLUMN_KEYS.length}
          onSubmit={(v) => {
            if (v.length > 0) {
              onChange({ columns: COLUMN_KEYS.filter((c): c is ColumnKey => v.includes(c)) });
              setMode('nav');
            }
          }}
        />
      );
    }
    return null;
  };

  return (
    <Overlay
      title="Options"
      width={width}
      hint={
        mode === 'nav'
          ? '↑↓ select · ←→ change · Enter edit · Esc close'
          : 'Enter confirm · Space toggle · Esc cancel'
      }
    >
      {OPTIONS.map((o, i) => {
        const selected = i === index;
        const fg = selected ? theme.selectedFg : theme.text;
        const editing = selected && mode !== 'nav';
        return (
          <Box key={o.key} flexDirection="column">
            <Box flexShrink={0}>
              <Text
                backgroundColor={selected ? theme.selectedBg : undefined}
                color={selected ? theme.selectedFg : theme.dim}
              >
                {(selected ? '▸ ' : '  ') + o.label.padEnd(LABEL_W)}
              </Text>
              <Text
                backgroundColor={selected ? theme.selectedBg : undefined}
                color={fg}
                bold
                wrap="truncate-end"
              >
                {editing && mode === 'number' ? '' : formatValue(config, o)}
              </Text>
              {editing && mode === 'number' ? editor() : null}
              {o.kind === 'readonly' ? (
                <Box marginLeft={1}>
                  <Badge color="yellow">restart</Badge>
                </Box>
              ) : null}
            </Box>
            {editing && mode === 'columns' ? <Box marginLeft={2}>{editor()}</Box> : null}
          </Box>
        );
      })}
    </Overlay>
  );
}
