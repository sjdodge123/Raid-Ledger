import { type ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { ValheimLinkConnectionCloseFilter } from './valheim-link-connection-close.filter';

function host() {
  const res = {
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  const h = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { h, res };
}

describe('ValheimLinkConnectionCloseFilter (ROK-1833)', () => {
  it('sets Connection: close on an HttpException (e.g. a guard 401) and keeps its body', () => {
    const { h, res } = host();
    const body = { code: 'invalid_token', message: 'Invalid token' };
    new ValheimLinkConnectionCloseFilter().catch(
      new UnauthorizedException(body),
      h,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('a non-HttpException becomes a generic 500, also with Connection: close', () => {
    const { h, res } = host();
    new ValheimLinkConnectionCloseFilter().catch(
      new Error('ENOENT /data/valheim-link/blobs/7/x.png'),
      h,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
