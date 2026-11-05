declare module 'react-native-keyevent' {
  export interface KeyEventProps {
    keyCode: number;
    action: number;
  }

  export default class KeyEvent {
    static onKeyDownListener(callback: (keyEvent: KeyEventProps) => void): void;
    static onKeyUpListener(callback: (keyEvent: KeyEventProps) => void): void;
    static removeKeyDownListener(): void;
    static removeKeyUpListener(): void;
  }
}