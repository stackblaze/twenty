/* Licensed under AGPLv3 */

import { ArgsType, Field } from '@nestjs/graphql';

import { IsNotEmpty, IsString } from 'class-validator';

@ArgsType()
export class BillingSetPartnerCodeInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  partnerCode: string;
}
