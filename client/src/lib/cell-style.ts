import type { ITheme } from '@xterm/xterm';

/** The parts of xterm's `IBufferCell` that decide how a cell is painted. */
export interface CellAttributes {
    isBold(): number;
    isItalic(): number;
    isDim(): number;
    isInverse(): number;
    isInvisible(): number;
    isUnderline(): number;
    isFgDefault(): boolean;
    isFgPalette(): boolean;
    isBgDefault(): boolean;
    isBgPalette(): boolean;
    getFgColor(): number;
    getBgColor(): number;
}

export interface CellStyle {
    readonly foreground: string;
    readonly background: string;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly dim: boolean;
    readonly invisible: boolean;
    readonly underline: boolean;
}

export interface CellPalette {
    readonly foreground: string;
    readonly background: string;
    readonly ansi: readonly string[];
}

const ANSI_THEME_KEYS = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

// xterm's own defaults, so cells painted here match the cells xterm paints
const XTERM_ANSI = [
    '#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
    '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
];
const XTERM_FOREGROUND = '#ffffff';
const XTERM_BACKGROUND = '#000000';
const CUBE_LEVELS = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
const CUBE_SIZE = 216;
const GREY_COUNT = 24;
const BRIGHT_OFFSET = 8;

function rgbCss(rgb: number): string {
    return `#${rgb.toString(16).padStart(6, '0')}`;
}

function channelsCss(red: number, green: number, blue: number): string {
    return rgbCss((red << 16) | (green << 8) | blue);
}

function extendedColors(): string[] {
    const colors: string[] = [];
    for (let index = 0; index < CUBE_SIZE; index++) {
        colors.push(channelsCss(
            CUBE_LEVELS[Math.floor(index / 36) % 6],
            CUBE_LEVELS[Math.floor(index / 6) % 6],
            CUBE_LEVELS[index % 6],
        ));
    }
    for (let index = 0; index < GREY_COUNT; index++) {
        const level = 8 + index * 10;
        colors.push(channelsCss(level, level, level));
    }
    return colors;
}

export function paletteFromTheme(theme: ITheme): CellPalette {
    const ansi = ANSI_THEME_KEYS.map((key, index) => theme[key] ?? XTERM_ANSI[index]);
    return {
        foreground: theme.foreground ?? XTERM_FOREGROUND,
        background: theme.background ?? XTERM_BACKGROUND,
        ansi: [...ansi, ...extendedColors()],
    };
}

function foregroundOf(cell: CellAttributes, palette: CellPalette, boldIsBright: boolean): string {
    if (cell.isFgDefault()) {
        return palette.foreground;
    }
    if (!cell.isFgPalette()) {
        return rgbCss(cell.getFgColor());
    }
    const index = cell.getFgColor();
    const brighten = boldIsBright && cell.isBold() !== 0 && index < BRIGHT_OFFSET;
    return palette.ansi[brighten ? index + BRIGHT_OFFSET : index];
}

function backgroundOf(cell: CellAttributes, palette: CellPalette): string {
    if (cell.isBgDefault()) {
        return palette.background;
    }
    return cell.isBgPalette() ? palette.ansi[cell.getBgColor()] : rgbCss(cell.getBgColor());
}

export function resolveCellStyle(cell: CellAttributes, palette: CellPalette, boldIsBright: boolean): CellStyle {
    const foreground = foregroundOf(cell, palette, boldIsBright);
    const background = backgroundOf(cell, palette);
    const inverse = cell.isInverse() !== 0;
    return {
        foreground: inverse ? background : foreground,
        background: inverse ? foreground : background,
        bold: cell.isBold() !== 0,
        italic: cell.isItalic() !== 0,
        dim: cell.isDim() !== 0,
        invisible: cell.isInvisible() !== 0,
        underline: cell.isUnderline() !== 0,
    };
}
