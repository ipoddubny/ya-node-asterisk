declare module 'yana' {
  import { EventEmitter } from "events";

  interface AMIOptions {
    host?: string;
    port?: number;
    reconnect?: boolean;
    events?: string | boolean;
    login: string;
    password?: string;
  }

  type ConnectCallback = (err: Error | undefined | null) => void;
  type SendCallback = (err: Error | undefined | null, message: object) => void;
  type DisconnectCallback = (err: Error | undefined | null) => void;

  class AMI extends EventEmitter {
    constructor(options: AMIOptions);
    connect(cb?: ConnectCallback): Promise<void>;
    send(action: object, cb?: SendCallback): Promise<object>;
    disconnect(cb?: DisconnectCallback): Promise<void>;
  }

  export = AMI;
}
