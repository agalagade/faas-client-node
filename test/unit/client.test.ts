import * as jwt from 'jsonwebtoken';
import request from 'request-promise';
import {BaseClient} from '../../src/client/baseClient';
import {Client} from '../../src/client/client';
import {CsdsClient} from '../../src/helper/csdsClient';
import {BaseConfig, Config} from '../../src/client/clientConfig';
import {RequestError} from 'request-promise/errors';
import {Options} from 'request';
import {IncomingMessage} from 'http';
import {AccessToken, Token} from 'simple-oauth2';
const secret = 'mySecret';

jest.mock('../../src/helper/csdsClient', () => {
  return {
    CsdsClient: jest.fn().mockImplementation(() => {
      return {
        get: jest.fn(() => 'someDomain'),
      };
    }),
  };
});
jest.mock('request-promise', () => {
  return jest.fn(async url => {
    return {
      url: 'helloWorld',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {resp: 'body'},
      ok: true,
      status: 200,
      statusText: 'OK',
    };
  });
});

const token: Token = {
  access_token: jwt.sign(
    {
      aud: 'le4711',
      azp: 'bf16f923-b256-40c8-afa5-1b8e8372da09',
      scope: 'faas.lambda.invoke',
      iss: 'Sentinel',
      exp: Date.now() / 1000 + 60 * 60,
      iat: Date.now(),
    },
    secret
  ),
};

jest.mock('simple-oauth2', () => ({
  ClientCredentials: jest.fn(() => ({
    getToken: async (): Promise<AccessToken> => ({
      token,
      expired: () => false,
      refresh: async () => null as any,
      revoke: async () => {},
      revokeAll: async () => {},
    }),
  })),
}));

const requestMock: jest.Mock<any> = request as any;

const testConfig: Required<BaseConfig> = {
  accountId: '123456',
  authStrategy: {
    clientId: 'foo',
    clientSecret: 'bar',
  },
};

describe('Client', () => {
  afterEach(jest.clearAllMocks);
  describe('success flows', () => {
    test('class and constructor - Base', () => {
      const client = new Client(testConfig);
      expect(CsdsClient).toHaveBeenCalledTimes(1);
      expect(client).toBeInstanceOf(Client);
      expect(client).toBeInstanceOf(BaseClient);
    });

    test('invoke method', async () => {
      const client1 = new Client(testConfig);

      await expect(
        client1.invoke({
          eventId: 'fooBar',
          externalSystem: 'testSystem',
          body: {
            payload: {},
          },
        })
      ).resolves.toBeNonEmptyObject();

      const client2 = new Client({...testConfig, accountId: 'le12345'});
      await expect(
        client2.invoke({
          eventId: 'fooBar',
          externalSystem: 'testSystem',
          body: {
            payload: {},
          },
        })
      ).resolves.toBeNonEmptyObject();
      expect(request).toHaveBeenCalledTimes(2);
    });

    test('getLambdas method', async () => {
      const client = new Client({...testConfig, accountId: 'fr12345'});
      await expect(
        client.getLambdas({
          accountId: '123456',
          externalSystem: 'testSystem',
        })
      ).resolves.toBeNonEmptyObject();

      expect(request).toHaveBeenCalledTimes(1);
    });

    test('should retry on receiving a network error', async () => {
      requestMock.mockClear(); //  To ensure only current calls are included
      requestMock.mockRejectedValueOnce(
        new RequestError(
          {code: 'ECONNRESET'},
          {} as Options,
          {} as IncomingMessage
        )
      );
      const client = new Client(testConfig);

      await expect(
        client.invoke({
          lambdaUuid: '4714',
          externalSystem: 'test-system',
          body: {
            payload: {},
          },
        })
      ).resolves.toBeNonEmptyObject();
      expect(requestMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Unhappy flows', () => {
    test('should throw if Functions returns a none-okay status code', () => {
      requestMock.mockRejectedValueOnce({
        response: {
          headers: [],
          body: {},
          statusCode: 502,
          statusMessage: 'Whoops',
        },
      });
      const config: Config = {...testConfig, failOnErrorStatusCode: true};
      const client = new Client(config);

      expect(
        client.invoke({
          lambdaUuid: '4711',
          externalSystem: 'test-system',
          body: {
            payload: {},
          },
        })
      ).rejects.toMatchObject({
        name: 'FaaSInvokeError',
        message: expect.stringContaining('502 - Whoops'),
      });
    });

    test('should throw if network errors are raised continuously', async () => {
      requestMock.mockClear(); //  To ensure only current calls are included
      requestMock.mockRejectedValue(
        new RequestError(
          {code: 'ECONNRESET'},
          {} as Options,
          {} as IncomingMessage
        )
      );
      const config: Config = {...testConfig, failOnErrorStatusCode: true};
      const client = new Client(config);

      await expect(
        client.invoke({
          lambdaUuid: '4714',
          externalSystem: 'test-system',
          body: {
            payload: {},
          },
        })
      ).rejects.toMatchObject({
        name: 'FaaSInvokeError',
      });

      expect(requestMock).toHaveBeenCalledTimes(3);
    });
  });
});
