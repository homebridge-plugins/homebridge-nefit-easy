declare module 'bosch-xmpp' {
  export interface BoschCredentials {
    serialNumber: string;
    accessKey: string;
    password: string;
  }

  export interface BoschClient {
    connect(): Promise<void>;
    get(uri: string): Promise<unknown>;
    put(uri: string, data: unknown): Promise<unknown>;
    end(): Promise<void>;
  }

  // bosch-xmpp is CommonJS. Under Node's ESM interop the whole module.exports
  // object arrives as the default export and named imports are unavailable, so
  // the runtime shape is modelled as a default export here.
  const boschXmpp: {
    NefitEasyClient(credentials: BoschCredentials): BoschClient;
  };

  export default boschXmpp;
}
