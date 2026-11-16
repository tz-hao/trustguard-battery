import 'reflect-metadata';
import { Catch, Module, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodError } from 'zod';
import { loadConfiguration, fingerprint } from './config.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { TransactionService, safeErrorCode } from './transactions.js';
import { RiskService } from './risk.js';
import { InternalClient,InternalServiceError } from './internal-client.js';
import { AuditService } from './audit.js';
import { authentication } from './auth.js';
import { BatteryController } from './controller.js';
import { FileService } from './files.js';
import { IngestionService } from './ingestion.js';
import { TraceService } from './trace.js';
import { PolicyService } from './policy.js';
import {HealthService} from './health.js';
import { OverviewService } from './overview.js';

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof ZodError) { response.status(400).json({ code: 'INVALID_INPUT', fields: error.issues.map(issue => issue.path.join('.')) }); return; }
    if (error instanceof HttpException) { response.status(error.getStatus()).json(error.getResponse()); return; }
    if(error instanceof InternalServiceError){
      const status=error.status===422?400:error.status===403?403:503;
      response.status(status).json({code:status===400?'SOURCE_VERIFICATION_FAILED':status===403?'RESOURCE_AUTHORIZATION_DENIED':'DEPENDENCY_UNAVAILABLE'});return;
    }
    const code = safeErrorCode(error);
    response.status(code === 'DEPENDENCY_UNAVAILABLE' ? 503 : code === 'FORBIDDEN' ? 403 : 400).json({ code });
  }
}

async function main() {
  const config = loadConfiguration();
  const database = new Database(config.databaseUrl);
  await database.migrate();
  const fabric = new FabricService(config);
  const internal = new InternalClient();
  const audit = new AuditService(database);
  const transactions = new TransactionService(database, fabric);
  const risk = new RiskService(database, fabric, internal,config.identities);
  const files = new FileService(database, fabric, internal);
  const ingestion = new IngestionService(database, fabric, internal);
  const trace = new TraceService(database,fabric,config.channel);
  const policies=new PolicyService(database,fabric);
  const healthService=new HealthService(database,fabric,internal);
  const overview = new OverviewService(database, fabric, internal, config.identities, config.channel);
  await files.check();
  @Module({ controllers: [BatteryController], providers: [
    { provide: FabricService, useValue: fabric }, { provide: TransactionService, useValue: transactions }, { provide: RiskService, useValue: risk },
    { provide: FileService, useValue: files },
    { provide: IngestionService, useValue: ingestion },
    { provide: TraceService, useValue: trace },
    { provide: PolicyService, useValue: policies },
    {provide:HealthService,useValue:healthService},
    { provide: OverviewService, useValue: overview },
  ] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { httpsOptions: config.tls, logger: false, bodyParser: true });
  app.useBodyParser('json', { limit: '8mb' });
  app.use(authentication(config, audit));
  app.useGlobalFilters(new SafeExceptionFilter());
  const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('智权链·锂安溯 Backend').setVersion('0.1.0').build());
  SwaggerModule.setup('api/docs', app, spec, { ui: false, raw: ['json'] });
  await app.listen(config.port, '127.0.0.1');
  console.log(`Local mTLS API ready on port ${config.port}; server certificate ${fingerprint(config.tls.cert)}`);
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    await app.close(); await fabric.close(); internal.close(); files.close(); await database.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}

main().catch(() => { console.error('API startup failed: verify local configuration, certificates and dependencies'); process.exitCode = 1; });
