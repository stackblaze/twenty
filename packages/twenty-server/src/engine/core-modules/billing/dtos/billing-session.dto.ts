/* Licensed under AGPLv3 */

import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('BillingSession')
export class BillingSessionDTO {
  @Field(() => String, { nullable: true })
  url: string;
}
