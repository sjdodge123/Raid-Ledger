import { type ArgumentsHost } from '@nestjs/common';
import { CompanionConnectionCloseFilter } from './companion-connection-close.filter';
import { companionError } from './companion-ingest.errors';

function host(headersSent = false) {
  const res = {
    headersSent,
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

describe('CompanionConnectionCloseFilter (ROK-1956)', () => {
  it('closes the connection on a companion error and keeps its body', () => {
    const { h, res } = host();
    const err = companionError('payload_too_large', 'Too large');
    new CompanionConnectionCloseFilter().catch(err, h);
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      code: 'payload_too_large',
      message: 'Too large',
    });
  });

  it('a non-HttpException becomes a generic 500 with Connection: close', () => {
    const { h, res } = host();
    new CompanionConnectionCloseFilter().catch(new Error('ENOENT /data/x'), h);
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  it('does not set a header once headers were sent', () => {
    const { h, res } = host(true);
    new CompanionConnectionCloseFilter().catch(
      companionError('unauthorized', 'u'),
      h,
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
