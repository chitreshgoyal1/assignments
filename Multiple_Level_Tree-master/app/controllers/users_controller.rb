class UsersController < ApplicationController
  def index
    @root = User.all
    @user = User.new
    #@children = @root.children
    # @all_children = @root.all_children
  end
  def create
    @user = User.create(params[:user])
    redirect_to :controller => :users, :action => :index
    #render :text=>"<pre>"+@user.to_yaml and return
  end
  
  def edit
    @user = User.find(params[:id])
  end
  
  def update

    @user = User.find(params[:id])

    respond_to do |format|
      if @user.update_attributes(params[:user])
        format.html { redirect_to :controller => :users, :action => :index, notice: 'User was successfully updated.' }
        format.xml  { head :ok }
        format.json { head :ok }
      else
        format.html { render action: "edit" }
        format.xml  { render :xml => @user.errors, :status => :unprocessable_entity }
        format.json { render json: @user.errors, status: :unprocessable_entity }
      end
    end
  end
end
