/**
 * SCORM API error codes and their standard human-readable strings, for both
 * the SCORM 1.2 (`LMSGetLastError`) and 2004 (`GetLastError`) surfaces.
 *
 * The bridge is deliberately thin: authoritative CMI validation happens on the
 * engine at commit time. These codes cover the lifecycle/argument errors the
 * synchronous API contract requires the bridge itself to report.
 */

export const NO_ERROR = '0';

/** SCORM 1.2 error codes. */
export const Scorm12Error = {
  NoError: '0',
  GeneralException: '101',
  InvalidArgument: '201',
  ElementCannotHaveChildren: '202',
  ElementNotAnArray: '203',
  NotInitialized: '301',
  NotImplemented: '401',
  ElementIsKeyword: '402',
  ElementReadOnly: '403',
  ElementWriteOnly: '404',
  IncorrectDataType: '405',
} as const;

const SCORM12_STRINGS: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '201': 'Invalid argument error',
  '202': 'Element cannot have children',
  '203': 'Element not an array - cannot have count',
  '301': 'Not initialized',
  '401': 'Not implemented error',
  '402': 'Invalid set value, element is a keyword',
  '403': 'Element is read only',
  '404': 'Element is write only',
  '405': 'Incorrect data type',
};

/** SCORM 2004 4th edition error codes. */
export const Scorm2004Error = {
  NoError: '0',
  GeneralException: '101',
  GeneralInitializationFailure: '102',
  AlreadyInitialized: '103',
  ContentInstanceTerminated: '104',
  GeneralTerminationFailure: '111',
  TerminationBeforeInitialization: '112',
  TerminationAfterTermination: '113',
  RetrieveDataBeforeInitialization: '122',
  RetrieveDataAfterTermination: '123',
  StoreDataBeforeInitialization: '132',
  StoreDataAfterTermination: '133',
  CommitBeforeInitialization: '142',
  CommitAfterTermination: '143',
  GeneralArgumentError: '201',
  GeneralGetFailure: '301',
  GeneralSetFailure: '351',
  GeneralCommitFailure: '391',
  UndefinedDataModelElement: '401',
  UnimplementedDataModelElement: '402',
  DataModelElementValueNotInitialized: '403',
  DataModelElementReadOnly: '404',
  DataModelElementWriteOnly: '405',
  DataModelElementTypeMismatch: '406',
  DataModelElementValueOutOfRange: '407',
  DataModelDependencyNotEstablished: '408',
} as const;

const SCORM2004_STRINGS: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '102': 'General initialization failure',
  '103': 'Already initialized',
  '104': 'Content instance terminated',
  '111': 'General termination failure',
  '112': 'Termination before initialization',
  '113': 'Termination after termination',
  '122': 'Retrieve data before initialization',
  '123': 'Retrieve data after termination',
  '132': 'Store data before initialization',
  '133': 'Store data after termination',
  '142': 'Commit before initialization',
  '143': 'Commit after termination',
  '201': 'General argument error',
  '301': 'General get failure',
  '351': 'General set failure',
  '391': 'General commit failure',
  '401': 'Undefined data model element',
  '402': 'Unimplemented data model element',
  '403': 'Data model element value not initialized',
  '404': 'Data model element is read only',
  '405': 'Data model element is write only',
  '406': 'Data model element type mismatch',
  '407': 'Data model element value out of range',
  '408': 'Data model dependency not established',
};

export function errorString(version: 'SCORM_1_2' | '2004', code: string): string {
  const table = version === 'SCORM_1_2' ? SCORM12_STRINGS : SCORM2004_STRINGS;
  return table[code] ?? '';
}
