import type { FastifyInstance } from 'fastify';
import {
  AvailabilityParamsSchema,
  AvailabilityResponseSchema,
  CreateServiceRequestSchema,
  DeliveryParamsSchema,
  DeliveryResponseSchema,
  EncounterDetailResponseSchema,
  EncounterListQuerySchema,
  EncounterListResponseSchema,
  EncounterParamsSchema,
  EncounterResponseSchema,
  OpenEncounterRequestSchema,
  PatientDetailResponseSchema,
  PatientParamsSchema,
  PatientResponseSchema,
  PatientSearchQuerySchema,
  PatientSearchResponseSchema,
  RecordDeliveryRequestSchema,
  RegisterPatientRequestSchema,
  ServiceCatalogueQuerySchema,
  ServiceCatalogueResponseSchema,
  ServiceParamsSchema,
  ServiceResponseSchema,
  SetAvailabilityRequestSchema,
  UpdateDeliveryRequestSchema,
  UpdateEncounterRequestSchema,
  UpdatePatientRequestSchema,
  UpdateServiceRequestSchema,
} from '@orbit/contracts';
import { operatorOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import { parseInput } from '../shared.ts';
import type { ModuleDeps } from '../ports.ts';
import { assertNotFuture, facilityFilter, found, requireAdmin, resolveFacility, respond, written } from './access.ts';

/** The service catalogue, patients, visits and services delivered. */
export function registerErpCareRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  const store = deps.erp;

  // ---- Services -----------------------------------------------------------
  api.get('/erp/services', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(ServiceCatalogueQuerySchema, request.query);
    const facilityId = (await facilityFilter(store, operator, query.facilityId)) ?? null;
    const items = await store.catalogue(operator, {
      facilityId,
      category: query.category ?? null,
      includeInactive: query.includeInactive ?? false,
    });
    return respond(ServiceCatalogueResponseSchema, { facilityId, items }, 'erp_catalogue_failed_contract');
  });

  api.post('/erp/services', async (request, reply) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const input = parseInput(CreateServiceRequestSchema, request.body);
    const service = await store.createService(operator, input, request.id);
    return reply.status(201).send(respond(ServiceResponseSchema, { service }, 'erp_service_failed_contract'));
  });

  api.patch('/erp/services/:serviceId', async (request) => {
    const operator = operatorOf(request);
    requireAdmin(operator);
    const { serviceId } = parseInput(ServiceParamsSchema, request.params);
    const input = parseInput(UpdateServiceRequestSchema, request.body);
    const service = written(await store.updateService(operator, serviceId, input, request.id), 'That service');
    return respond(ServiceResponseSchema, { service }, 'erp_service_failed_contract');
  });

  api.put('/erp/facilities/:facilityId/services/:serviceId', async (request) => {
    const operator = operatorOf(request);
    const target = parseInput(AvailabilityParamsSchema, request.params);
    await resolveFacility(store, operator, target.facilityId);
    const input = parseInput(SetAvailabilityRequestSchema, request.body);
    if (input.version === undefined) {
      // Offering a service at a facility for the first time is a catalogue decision.
      requireAdmin(operator);
    }
    const availability = written(await store.setAvailability(operator, target, input, request.id), 'That service');
    return respond(AvailabilityResponseSchema, { serviceId: target.serviceId, availability }, 'erp_availability_failed_contract');
  });

  // ---- Patients -----------------------------------------------------------
  api.get('/erp/patients', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(PatientSearchQuerySchema, request.query);
    const { items, total } = await store.searchPatients(operator, query);
    return respond(
      PatientSearchResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total } },
      'erp_patient_failed_contract',
    );
  });

  api.post('/erp/patients', async (request, reply) => {
    const operator = operatorOf(request);
    const input = parseInput(RegisterPatientRequestSchema, request.body);
    await resolveFacility(store, operator, input.homeFacilityId);
    const result = await store.registerPatient(operator, input, request.id);
    if (result.status === 'possible_duplicate') {
      throw new ApiError(
        'conflict',
        'A patient with this name and birth year is already registered. Search for them, or confirm this is a different person.',
        'possible_duplicate_patient',
      );
    }
    return reply.status(201).send(respond(PatientResponseSchema, { patient: result.patient }, 'erp_patient_failed_contract'));
  });

  api.get('/erp/patients/:patientId', async (request) => {
    const operator = operatorOf(request);
    const { patientId } = parseInput(PatientParamsSchema, request.params);
    const detail = found(await store.getPatient(operator, patientId, request.id), 'That patient');
    return respond(PatientDetailResponseSchema, { ...detail }, 'erp_patient_failed_contract');
  });

  api.patch('/erp/patients/:patientId', async (request) => {
    const operator = operatorOf(request);
    const { patientId } = parseInput(PatientParamsSchema, request.params);
    const input = parseInput(UpdatePatientRequestSchema, request.body);
    const patient = written(await store.updatePatient(operator, patientId, input, request.id), 'That patient');
    return respond(PatientResponseSchema, { patient }, 'erp_patient_failed_contract');
  });

  // ---- Visits (encounters) ------------------------------------------------
  api.get('/erp/encounters', async (request) => {
    const operator = operatorOf(request);
    const query = parseInput(EncounterListQuerySchema, request.query);
    const facilityId = await facilityFilter(store, operator, query.facilityId);
    const { items, total } = await store.listEncounters(operator, { ...query, facilityId });
    return respond(
      EncounterListResponseSchema,
      { items, page: { page: query.page, pageSize: query.pageSize, total } },
      'erp_encounter_failed_contract',
    );
  });

  api.post('/erp/encounters', async (request, reply) => {
    const operator = operatorOf(request);
    const input = parseInput(OpenEncounterRequestSchema, request.body);
    await resolveFacility(store, operator, input.facilityId);
    assertNotFuture(input.startedAt, 'The visit start');
    const encounter = found(await store.openEncounter(operator, input, request.id), 'That patient');
    return reply.status(201).send(respond(EncounterResponseSchema, { encounter }, 'erp_encounter_failed_contract'));
  });

  api.get('/erp/encounters/:encounterId', async (request) => {
    const operator = operatorOf(request);
    const { encounterId } = parseInput(EncounterParamsSchema, request.params);
    const detail = found(await store.getEncounter(operator, encounterId, request.id), 'That visit');
    return respond(EncounterDetailResponseSchema, { ...detail }, 'erp_encounter_failed_contract');
  });

  api.patch('/erp/encounters/:encounterId', async (request) => {
    const operator = operatorOf(request);
    const { encounterId } = parseInput(EncounterParamsSchema, request.params);
    const input = parseInput(UpdateEncounterRequestSchema, request.body);
    assertNotFuture(input.endedAt, 'The visit end');
    const encounter = written(await store.updateEncounter(operator, encounterId, input, request.id), 'That visit');
    return respond(EncounterResponseSchema, { encounter }, 'erp_encounter_failed_contract');
  });

  api.post('/erp/encounters/:encounterId/services', async (request, reply) => {
    const operator = operatorOf(request);
    const { encounterId } = parseInput(EncounterParamsSchema, request.params);
    const input = parseInput(RecordDeliveryRequestSchema, request.body);
    assertNotFuture(input.performedAt, 'The service time');
    const result = found(await store.recordDelivery(operator, encounterId, input, request.id), 'That visit');
    const body = respond(DeliveryResponseSchema, { ...result }, 'erp_delivery_failed_contract');
    return reply.status(result.replayed ? 200 : 201).send(body);
  });

  api.patch('/erp/service-deliveries/:deliveryId', async (request) => {
    const operator = operatorOf(request);
    const { deliveryId } = parseInput(DeliveryParamsSchema, request.params);
    const input = parseInput(UpdateDeliveryRequestSchema, request.body);
    const delivery = written(await store.updateDelivery(operator, deliveryId, input, request.id), 'That service record');
    return respond(DeliveryResponseSchema, { delivery, replayed: false }, 'erp_delivery_failed_contract');
  });
}
