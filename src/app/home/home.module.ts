import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomePage } from './home.page';

import { HomePageRoutingModule } from './home-routing.module';
import {AndroidPermissions} from "@ionic-native/android-permissions/ngx";
import {Diagnostic} from "@ionic-native/diagnostic/ngx";


@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule
  ],
  providers: [
    AndroidPermissions,
    Diagnostic,
  ],
  declarations: [HomePage]
})
export class HomePageModule {}
